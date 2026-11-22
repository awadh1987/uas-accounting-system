"use client";

import React, { useState } from "react";
import {
  Archive,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Globe,
  Landmark,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Smartphone,
  Trash2,
  Upload,
  Vault,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { CostCenterSelector } from "@/components/CostCenterSelector";
import { SaveDraftButton } from "@/components/SaveDraftButton";
import { SelectWithOther } from "@/components/SelectWithOther";
import { BankPayoutModal, type PayoutInitialData } from "@/components/BankPayoutModal";
import { fmtNum, formatCurrencyVal, type CurrencyCode } from "@/lib/formulas";
import type {
  UasInstallmentVoucher,
  UasSaleTransaction,
  UasTreasuryAccount,
  UasUser,
  UasWorkerWage,
} from "@/types/uas";

interface ReconcileEntryItem {
  lineId: string;
  journalEntryId: string;
  entryNumber: string;
  date: string;
  reference: string | null;
  narrationAr: string;
  sourceType: string;
  debit: number;
  credit: number;
  debitBase: number;
  creditBase: number;
  reconciled: boolean;
}

interface ReconcilePayload {
  treasury: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    type: string;
    currency: string;
    balance: number;
    balanceYER: number;
    glBookBalanceYER: number;
    varianceYER: number;
  };
  entries: ReconcileEntryItem[];
}

interface AutoReconcileResult {
  matchedCount: number;
  matchedTotal: number;
  unmatchedUasCount: number;
  unmatchedUasTotal: number;
  unmatchedBankCount: number;
  unmatchedBankTotal: number;
  details: Array<{
    date: string;
    referenceId?: string;
    description?: string;
    amount: number;
    status: "MATCHED" | "UNMATCHED_IN_SYSTEM" | "UNMATCHED_IN_BANK";
  }>;
}

interface TreasuryTabProps {
  currency: CurrencyCode;
  exchangeRates: Record<string, number>;
  treasuryAccounts: UasTreasuryAccount[];
  installments: UasInstallmentVoucher[];
  sales: UasSaleTransaction[];
  workers: UasWorkerWage[];
  currentUser?: UasUser;
  readOnly?: boolean;
  canManageTreasury?: boolean;
  canEditDate?: boolean;
  onAddInstallment: (payload: {
    type: "CUSTOMER_RECEIPT" | "WORKER_PAYOUT";
    targetId: string;
    treasuryId: string;
    amount: number;
    voucherNo: string;
    date: string;
    notes: string;
    costCenterId?: string | null;
  }) => Promise<boolean>;
  onRefreshState?: () => Promise<void>;
  onOpenInstallmentModal: (inst: UasInstallmentVoucher) => void;
  onExportExcel: () => void;
  onToast: (msg: string) => void;
}

const TYPE_META: Record<
  string,
  { labelAr: string; badgeClass: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  VAULT: {
    labelAr: "صندوق نقدي (Vault)",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    Icon: Vault,
  },
  BANK: {
    labelAr: "حساب بنكي (Bank)",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
    Icon: Landmark,
  },
  WALLET: {
    labelAr: "محفظة إلكترونية (Wallet)",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    Icon: Smartphone,
  },
};

const GATEWAY_PROVIDERS: Array<{ value: string; label: string }> = [
  { value: "MANUAL", label: "يدوي / Manual (بدون ربط مباشر)" },
  { value: "KURAIMI_API", label: "بنك الكريمي (Kuraimi Express API)" },
  { value: "JAWALI_API", label: "محفظة جوالي (Jawali Wallet API)" },
  { value: "JEEB_API", label: "محفظة جيب (Jeeb Wallet API)" },
  { value: "ONECASH_API", label: "ون كاش (OneCash API)" },
  { value: "FLOOSAK_API", label: "فلوسك (Floosak API)" },
  { value: "CUSTOM_WEBHOOK", label: "رابط مخصص (Custom API Webhook)" },
];

export function TreasuryTab({
  currency,
  exchangeRates,
  treasuryAccounts,
  installments,
  sales,
  workers,
  currentUser,
  readOnly = false,
  canManageTreasury = true,
  canEditDate = true,
  onAddInstallment,
  onRefreshState,
  onOpenInstallmentModal,
  onExportExcel,
  onToast,
}: TreasuryTabProps) {
  // Installment voucher drawer state
  const [type, setType] = useState<"CUSTOMER_RECEIPT" | "WORKER_PAYOUT">("CUSTOMER_RECEIPT");
  const [targetId, setTargetId] = useState(sales[0]?.id || "");
  const [treasuryId, setTreasuryId] = useState(treasuryAccounts[0]?.id || "t1");
  const [amount, setAmount] = useState("25000");
  const [voucherNo, setVoucherNo] = useState("RV-INST-201");
  const [costCenterId, setCostCenterId] = useState("");
  const [date, setDate] = useState("2026-11-10");
  const [notes, setNotes] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Treasury Setup / Edit drawer state
  const [setupDrawerOpen, setSetupDrawerOpen] = useState(false);
  const [editingTreasuryId, setEditingTreasuryId] = useState<string | null>(null);
  const [tType, setTType] = useState<string>("BANK");
  const [tNameAr, setTNameAr] = useState("");
  const [tNameEn, setTNameEn] = useState("");
  const [tCurrency, setTCurrency] = useState("YER");
  const [tProviderAr, setTProviderAr] = useState("");
  const [tHolder, setTHolder] = useState("");
  const [tAccountNo, setTAccountNo] = useState("");
  const [tIban, setTIban] = useState("");
  const [tBranch, setTBranch] = useState("");
  const [tFeePercent, setTFeePercent] = useState("0");
  const [tDailyLimit, setTDailyLimit] = useState("0");
  const [tOpeningBalance, setTOpeningBalance] = useState("0");
  const [tOpeningDate, setTOpeningDate] = useState("2026-11-10");
  const [tDefReceipts, setTDefReceipts] = useState(false);
  const [tDefPayments, setTDefPayments] = useState(false);
  const [tIsActive, setTIsActive] = useState(true);
  const [tNotes, setTNotes] = useState("");
  const [savingTreasury, setSavingTreasury] = useState(false);

  // Gateway Provider Config state
  const [tGatewayProvider, setTGatewayProvider] = useState("MANUAL");
  const [tGatewayMerchantId, setTGatewayMerchantId] = useState("");
  const [tGatewayEndpointUrl, setTGatewayEndpointUrl] = useState("");
  const [tGatewayCredentialsEnc, setTGatewayCredentialsEnc] = useState("");
  const [tIsSandbox, setTIsSandbox] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [gatewaySectionOpen, setGatewaySectionOpen] = useState(false);

  // Filter archived treasuries
  const [showArchivedTreasuries, setShowArchivedTreasuries] = useState(false);

  // FX Inter-Treasury Transfer drawer state
  const [transferDrawerOpen, setTransferDrawerOpen] = useState(false);
  const [txFromId, setTxFromId] = useState(treasuryAccounts[0]?.id || "");
  const [txToId, setTxToId] = useState(treasuryAccounts[1]?.id || treasuryAccounts[0]?.id || "");
  const [txAmount, setTxAmount] = useState("50000");
  const [txApplyDefaultFee, setTxApplyDefaultFee] = useState(true);
  const [txFeeAmount, setTxFeeAmount] = useState("");
  const [txRateOverride, setTxRateOverride] = useState("");
  const [txDate, setTxDate] = useState("2026-11-10");
  const [txReference, setTxReference] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [submittingTransfer, setSubmittingTransfer] = useState(false);

  // Reconciliation Drawer state
  const [reconcileDrawerOpen, setReconcileDrawerOpen] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileData, setReconcileData] = useState<ReconcilePayload | null>(null);
  const [stmtBalance, setStmtBalance] = useState("");
  const [stmtDate, setStmtDate] = useState("2026-11-10");
  const [stmtNotes, setStmtNotes] = useState("");
  const [savingReconcile, setSavingReconcile] = useState(false);

  // Bulk Bank File Export state
  const [batchFormat, setBatchFormat] = useState<"xlsx" | "csv">("xlsx");
  const [exportingBatch, setExportingBatch] = useState(false);

  // Auto-Reconciliation file import state
  const [autoReconciling, setAutoReconciling] = useState(false);
  const [autoReconcileResult, setAutoReconcileResult] = useState<AutoReconcileResult | null>(null);

  // Live Payout Execution Modal state
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [payoutInitialData, setPayoutInitialData] = useState<PayoutInitialData | null>(null);

  const actor = currentUser
    ? { userId: currentUser.id, userDisplay: currentUser.name, userRole: currentUser.role }
    : undefined;

  const targets = type === "CUSTOMER_RECEIPT" ? sales : workers;
  const effectiveTargetId = targets.some((t) => t.id === targetId)
    ? targetId
    : targets[0]?.id || "";

  function handleTypeChange(nextType: "CUSTOMER_RECEIPT" | "WORKER_PAYOUT") {
    setType(nextType);
    const nextList = nextType === "CUSTOMER_RECEIPT" ? sales : workers;
    setTargetId(nextList[0]?.id || "");
    setVoucherNo(nextType === "CUSTOMER_RECEIPT" ? "RV-INST-201" : "PV-INST-201");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount) || 0;
    if (numericAmount <= 0 || !effectiveTargetId) {
      onToast("يرجى تحديد السجل وإدخال مبلغ صحيح");
      return;
    }
    const ok = await onAddInstallment({
      type,
      targetId: effectiveTargetId,
      treasuryId: treasuryId || treasuryAccounts[0]?.id || "t1",
      amount: numericAmount,
      voucherNo: voucherNo.trim() || `RV-INST-${Math.floor(100 + Math.random() * 900)}`,
      date: date || "2026-11-10",
      notes: notes.trim() || "دفعة مسجلة",
      costCenterId: costCenterId || undefined,
    });
    if (ok) {
      setNotes("");
      setCostCenterId("");
      setDrawerOpen(false);
    }
  }

  function openCreateTreasury() {
    setEditingTreasuryId(null);
    setTType("BANK");
    setTNameAr("");
    setTNameEn("");
    setTCurrency("YER");
    setTProviderAr("");
    setTHolder("");
    setTAccountNo("");
    setTIban("");
    setTBranch("");
    setTFeePercent("0");
    setTDailyLimit("0");
    setTOpeningBalance("0");
    setTOpeningDate("2026-11-10");
    setTDefReceipts(false);
    setTDefPayments(false);
    setTIsActive(true);
    setTNotes("");

    // Gateway defaults
    setTGatewayProvider("MANUAL");
    setTGatewayMerchantId("");
    setTGatewayEndpointUrl("");
    setTGatewayCredentialsEnc("");
    setTIsSandbox(true);
    setShowSecret(false);
    setGatewaySectionOpen(false);

    setSetupDrawerOpen(true);
  }

  function openEditTreasury(t: UasTreasuryAccount) {
    setEditingTreasuryId(t.id);
    const rawType = (t.type || "").toUpperCase();
    setTType(rawType === "BANK" || rawType === "WALLET" ? rawType : "VAULT");
    setTNameAr(t.nameAr || t.name || "");
    setTNameEn(t.nameEn || "");
    setTCurrency(String(t.currencyCode || "YER"));
    setTProviderAr(t.providerNameAr || "");
    setTHolder(t.accountHolderName || "");
    setTAccountNo(t.accountNo || "");
    setTIban(t.ibanOrSwift || "");
    setTBranch(t.branchOrAgent || "");
    setTFeePercent(String(t.transferFeePercent ?? 0));
    setTDailyLimit(String(t.dailyLimit ?? 0));
    setTOpeningBalance("0");
    setTDefReceipts(Boolean(t.isDefaultReceipts));
    setTDefPayments(Boolean(t.isDefaultPayments));
    setTIsActive(t.isActive !== false);
    setTNotes(t.notes || "");

    // Gateway settings
    const prov = t.gatewayProvider || "MANUAL";
    setTGatewayProvider(prov);
    setTGatewayMerchantId(t.gatewayMerchantId || "");
    setTGatewayEndpointUrl(t.gatewayEndpointUrl || "");
    setTGatewayCredentialsEnc(t.gatewayCredentialsEnc || "");
    setTIsSandbox(t.isSandbox !== false);
    setShowSecret(false);
    setGatewaySectionOpen(prov !== "MANUAL");

    setSetupDrawerOpen(true);
  }

  async function handleSaveTreasury(e: React.FormEvent) {
    e.preventDefault();
    if (!tNameAr.trim()) {
      onToast("يرجى إدخال اسم الصندوق / البنك / المحفظة");
      return;
    }
    setSavingTreasury(true);
    try {
      const isEdit = Boolean(editingTreasuryId);
      const res = await fetch("/api/treasury", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { id: editingTreasuryId } : {}),
          type: tType,
          nameAr: tNameAr.trim(),
          nameEn: tNameEn.trim() || undefined,
          currency: tCurrency,
          providerNameAr: tProviderAr.trim() || undefined,
          accountHolderName: tHolder.trim() || undefined,
          accountNumber: tAccountNo.trim() || undefined,
          ibanOrSwift: tIban.trim() || undefined,
          branchOrAgent: tBranch.trim() || undefined,
          transferFeePercent: Number(tFeePercent) || 0,
          dailyLimit: Number(tDailyLimit) || 0,
          ...(!isEdit && (Number(tOpeningBalance) || 0) > 0
            ? {
                openingBalance: Number(tOpeningBalance),
                openingDate: tOpeningDate || "2026-11-10",
              }
            : {}),
          isDefaultReceipts: tDefReceipts,
          isDefaultPayments: tDefPayments,
          isActive: tIsActive,
          notes: tNotes.trim() || undefined,
          // Live Gateway Integration Settings
          gatewayProvider: tGatewayProvider,
          gatewayMerchantId: tGatewayMerchantId.trim() || undefined,
          gatewayEndpointUrl: tGatewayEndpointUrl.trim() || undefined,
          gatewayCredentialsEnc: tGatewayCredentialsEnc.trim() || undefined,
          isSandbox: tIsSandbox,
          actor,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        onToast(data.error || "تعذر حفظ بيانات الخزينة");
        return;
      }
      onToast(
        isEdit
          ? `✅ تم تحديث بيانات الخزينة (${tNameAr.trim()}) بنجاح`
          : `✅ تم إنشاء (${tNameAr.trim()}) وفتح حساب أستاذ فرعي له في الشجرة`
      );
      setSetupDrawerOpen(false);
      await onRefreshState?.();
    } catch {
      onToast("تعذر الاتصال بالخادم");
    } finally {
      setSavingTreasury(false);
    }
  }

  // Handle Archive / Restore / Safe Delete
  async function handleLifecycleTreasury(
    t: UasTreasuryAccount,
    action: "ARCHIVE" | "RESTORE" | "SAFE_DELETE"
  ) {
    if (readOnly || !canManageTreasury) return;
    const actionLabel =
      action === "ARCHIVE"
        ? "أرشفة"
        : action === "RESTORE"
        ? "استعادة"
        : "حذف";

    if (
      action === "SAFE_DELETE" &&
      !confirm(`هل أنت متأكد من حذف الحساب (${t.nameAr || t.name})؟ إذا كان مرتبطاً بحركات مالية فسيتم أرشفته بأمان لمنع اختلال القيود.`)
    ) {
      return;
    }

    try {
      const res = await fetch("/api/system/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "TreasuryAccount",
          id: t.id,
          action,
          actor,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast(data.error || `تعذر ${actionLabel} الحساب`);
        return;
      }

      onToast(data.message || `✅ تم تنفيذ ${actionLabel} بنجاح`);
      await onRefreshState?.();
    } catch {
      onToast("تعذر الاتصال بالخادم");
    }
  }

  async function handleTransferSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fromId = txFromId || treasuryAccounts[0]?.id;
    const toId = txToId || treasuryAccounts[1]?.id;
    const amt = Number(txAmount) || 0;
    if (!fromId || !toId || fromId === toId || amt <= 0) {
      onToast("يرجى اختيار حسابي مصدر ووجهة مختلفين وإدخال مبلغ صحيح");
      return;
    }
    setSubmittingTransfer(true);
    try {
      const res = await fetch("/api/treasury/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromTreasuryId: fromId,
          toTreasuryId: toId,
          amount: amt,
          applyDefaultFee: txApplyDefaultFee,
          feeAmount: txFeeAmount.trim() !== "" ? Number(txFeeAmount) : undefined,
          exchangeRateOverride:
            txRateOverride.trim() !== "" ? Number(txRateOverride) : undefined,
          date: txDate || "2026-11-10",
          reference: txReference.trim() || undefined,
          notes: txNotes.trim() || undefined,
          actor,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        onToast(data.error || "تعذر تنفيذ التحويل بين الخزائن");
        return;
      }
      onToast("✅ تم تنفيذ التحويل المالي وترحيل القيد المزدوج وفروق/رسوم التحويل للـ GL");
      setTransferDrawerOpen(false);
      setTxReference("");
      setTxNotes("");
      await onRefreshState?.();
    } catch {
      onToast("تعذر الاتصال بالخادم");
    } finally {
      setSubmittingTransfer(false);
    }
  }

  async function openReconcileDrawer(treasuryIdToLoad: string) {
    setReconcileDrawerOpen(true);
    setReconcileLoading(true);
    setAutoReconcileResult(null);
    try {
      const res = await fetch(
        `/api/treasury/reconcile?treasuryId=${encodeURIComponent(treasuryIdToLoad)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as ReconcilePayload & { error?: string };
      if (!res.ok) {
        onToast(data.error || "تعذر تحميل كشف المطابقة");
        setReconcileDrawerOpen(false);
        return;
      }
      setReconcileData(data);
      setStmtBalance(String(data.treasury.balanceYER));
    } catch {
      onToast("تعذر تحميل كشف المطابقة");
      setReconcileDrawerOpen(false);
    } finally {
      setReconcileLoading(false);
    }
  }

  async function handleToggleReconciledEntry(entry: ReconcileEntryItem) {
    if (!reconcileData || readOnly || !canManageTreasury) return;
    try {
      const res = await fetch("/api/treasury/reconcile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treasuryId: reconcileData.treasury.id,
          toggleEntryId: entry.journalEntryId,
          reconciled: !entry.reconciled,
          actor,
        }),
      });
      if (!res.ok) {
        onToast("تعذر تحديث حالة مطابقة القيد");
        return;
      }
      await openReconcileDrawer(reconcileData.treasury.id);
    } catch {
      onToast("تعذر الاتصال بالخادم");
    }
  }

  async function handleSaveStatementReconcile(e: React.FormEvent) {
    e.preventDefault();
    if (!reconcileData || readOnly || !canManageTreasury) return;
    setSavingReconcile(true);
    try {
      const res = await fetch("/api/treasury/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treasuryId: reconcileData.treasury.id,
          statementBalance: Number(stmtBalance) || 0,
          statementDate: stmtDate || "2026-11-10",
          notes: stmtNotes.trim() || "مطابقة دورية مع كشف الحساب",
          actor,
        }),
      });
      if (!res.ok) {
        onToast("تعذر حفظ المطابقة البنكية");
        return;
      }
      onToast("✅ تم توثيق مطابقة كشف الخزينة / البنك في سجل التدقيق");
      await openReconcileDrawer(reconcileData.treasury.id);
    } finally {
      setSavingReconcile(false);
    }
  }

  // Handle Export Bulk Bank File
  async function handleExportBulkFile() {
    if (!reconcileData) return;
    setExportingBatch(true);
    try {
      // Build items from ledger entries or draft payouts
      const items = reconcileData.entries.map((e, idx) => ({
        beneficiaryName: e.narrationAr || `دفعة بنكية #${idx + 1}`,
        accountOrPhone: e.reference || "N/A",
        amount: Math.abs(e.creditBase || e.credit || e.debitBase || e.debit || 1000),
        currencyCode: reconcileData.treasury.currency || "YER",
        reference: e.entryNumber || `DSP-${idx + 1}`,
        notes: e.narrationAr || "تسديد بنكي معتمد",
      }));

      // Fallback sample if empty
      const payloadItems =
        items.length > 0
          ? items
          : [
              {
                beneficiaryName: "مستفيد تجريبي",
                accountOrPhone: "770000000",
                amount: 50000,
                currencyCode: reconcileData.treasury.currency || "YER",
                reference: "DSP-TEST-001",
                notes: "إرسالية دفع تجريبية",
              },
            ];

      const res = await fetch("/api/treasury/batch-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treasuryAccountId: reconcileData.treasury.id,
          treasuryName: reconcileData.treasury.nameAr,
          provider: reconcileData.treasury.type,
          items: payloadItems,
          format: batchFormat,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        onToast(data.error || "فشل تصدير ملف التحويلات البنكية");
        return;
      }

      // Trigger file download in browser
      const byteCharacters = atob(data.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: data.mimeType });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      onToast(`✅ تم تصدير ملف التحويلات البنكية (${data.count} حركة بمبلغ ${fmtNum(data.totalAmount)} ${reconcileData.treasury.currency})`);
    } catch {
      onToast("حدث خطأ أثناء تصدير ملف البنك");
    } finally {
      setExportingBatch(false);
    }
  }

  // Handle Auto-Reconcile File Import
  async function handleAutoReconcileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !reconcileData) return;

    setAutoReconciling(true);
    setAutoReconcileResult(null);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64 = (event.target?.result as string).split(",")[1];
          const res = await fetch("/api/treasury/reconcile-import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              treasuryAccountId: reconcileData.treasury.id,
              base64File: base64,
            }),
          });
          const json = await res.json();
          if (res.ok && json.ok) {
            setAutoReconcileResult(json.result);
            onToast(
              `✅ تمت المطابقة الآلية: ${json.result.matchedCount} مطابقة بنجاح، ${json.result.unmatchedUasCount} غير مسجل، ${json.result.unmatchedBankCount} غير ظاهر بالبنك`
            );
          } else {
            onToast(json.error || "فشل تحليل ومطابقة كشف الحساب");
          }
        } catch {
          onToast("حدث خطأ أثناء معالجة ملف الكشف");
        } finally {
          setAutoReconciling(false);
          e.target.value = "";
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setAutoReconciling(false);
      onToast("تعذر قراءة الملف");
    }
  }

  const fromAcc = treasuryAccounts.find((t) => t.id === (txFromId || treasuryAccounts[0]?.id));
  const computedDefaultFee =
    txApplyDefaultFee && fromAcc?.transferFeePercent
      ? ((Number(txAmount) || 0) * fromAcc.transferFeePercent) / 100
      : 0;

  // Filter treasury cards based on archive toggle
  const visibleTreasuries = treasuryAccounts.filter(
    (t) => (showArchivedTreasuries ? true : t.isActive !== false && !t.archivedAt)
  );

  return (
    <section className="space-y-6">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              إدارة الخزينة والبنوك والمحافظ الإلكترونية (Treasury &amp; Wallets Engine)
            </h3>
            <p className="text-xs text-slate-500">
              إنشاء وربط الصناديق والحسابات البنكية والمحافظ (الكريمي، جوالي، جيب، ون كاش، فلوسك) بحسابات الجيل السادس (Gen-6) وبوابات الدفع الإلكتروني والمطابقة الآلية
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-bold accent-badge px-3 py-1.5 rounded-xl tabular-nums">
              1 SAR = {exchangeRates.SAR || 425} YER | 1 USD = {fmtNum(exchangeRates.USD || 1620)} YER
            </div>

            {/* Archive Toggle Filter */}
            <button
              type="button"
              onClick={() => setShowArchivedTreasuries((p) => !p)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-extrabold transition ${
                showArchivedTreasuries
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                  : "bg-slate-200/50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600"
              }`}
            >
              {showArchivedTreasuries ? "إخفاء المؤرشفين" : "إظهار المؤرشفين"}
            </button>

            {!readOnly && canManageTreasury && (
              <>
                {/* Live Payout Dispatch Button */}
                <button
                  type="button"
                  onClick={() => {
                    setPayoutInitialData({
                      sourceVoucherType: "TREASURY_TRANSFER",
                      sourceVoucherId: `DISP-${Date.now()}`,
                      beneficiaryName: "",
                      beneficiaryAccountOrPhone: "",
                      amount: 0,
                      currencyCode: "YER",
                      notes: "صرف أو تحويل بنكي مباشر",
                    });
                    setPayoutModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>تنفيذ تحويل بنكي / محفظة</span>
                </button>

                {/* FX Inter-Treasury Transfer Button */}
                <button
                  type="button"
                  onClick={() => {
                    setTxFromId(treasuryAccounts[0]?.id || "");
                    setTxToId(treasuryAccounts[1]?.id || treasuryAccounts[0]?.id || "");
                    setTransferDrawerOpen(true);
                  }}
                  disabled={treasuryAccounts.length < 2}
                  className="px-3.5 py-2 rounded-xl border border-indigo-600/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 text-xs font-extrabold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>تحويل بين الخزائن (FX)</span>
                </button>

                {/* Add Treasury Button */}
                <button
                  type="button"
                  onClick={openCreateTreasury}
                  className="px-3.5 py-2 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة صندوق / بنك / محفظة</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Bank & Wallet Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {visibleTreasuries.map((t) => {
            const rawType = (t.type || "VAULT").toUpperCase();
            const meta = TYPE_META[rawType] || TYPE_META.VAULT;
            const TypeIcon = meta.Icon;
            const isArchived = t.isActive === false || Boolean(t.archivedAt);
            const hasGateway = t.gatewayProvider && t.gatewayProvider !== "MANUAL";

            return (
              <div
                key={t.id}
                className={`p-4 rounded-2xl border space-y-2.5 flex flex-col justify-between transition ${
                  isArchived
                    ? "border-amber-300/60 bg-amber-50/20 dark:bg-amber-950/10 dark:border-amber-800/40 opacity-75"
                    : "border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold ${meta.badgeClass}`}
                    >
                      <TypeIcon className="w-3 h-3" />
                      <span>{meta.labelAr}</span>
                    </span>

                    {/* Archived Badge */}
                    {isArchived && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        مؤرشف
                      </span>
                    )}

                    <span className="text-[11px] font-mono text-slate-400">
                      {t.accountNo}
                    </span>
                  </div>

                  <div className="font-extrabold text-sm text-slate-900 dark:text-white">
                    {t.nameAr || t.name}
                  </div>
                  {t.providerNameAr && (
                    <div className="text-[11px] text-slate-500">
                      {t.providerNameAr}
                      {t.accountNo ? ` • ${t.accountNo}` : ""}
                    </div>
                  )}

                  <div className="text-lg font-extrabold text-emerald-600 pt-1 tabular-nums">
                    {formatCurrencyVal(t.balanceYER, currency, exchangeRates)}
                  </div>
                  <div className="text-[11px] text-slate-400 tabular-nums flex items-center justify-between">
                    <span>الرصيد: {fmtNum(t.balanceYER)} YER</span>
                    <span className="font-mono font-bold text-slate-500">{t.currencyCode}</span>
                  </div>

                  <div className="flex flex-wrap gap-1 pt-1">
                    {/* Gateway Badge */}
                    {hasGateway && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 text-[9px] font-bold border border-blue-200 dark:border-blue-800">
                        بوابة: {t.gatewayProvider} {t.isSandbox ? "(تجريبي)" : "(حي)"}
                      </span>
                    )}
                    {t.isDefaultReceipts && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold">
                        افتراضي قبض
                      </span>
                    )}
                    {t.isDefaultPayments && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-bold">
                        افتراضي صرف
                      </span>
                    )}
                    {Number(t.transferFeePercent || 0) > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 text-[9px] font-mono">
                        عمولة {t.transferFeePercent}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => void openReconcileDrawer(t.id)}
                      className="font-bold text-indigo-600 hover:underline inline-flex items-center gap-1"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>كشف ومطابقة</span>
                    </button>

                    {/* Instant Payout Button */}
                    {!readOnly && canManageTreasury && !isArchived && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayoutInitialData({
                            treasuryAccountId: t.id,
                            sourceVoucherType: "TREASURY_TRANSFER",
                            sourceVoucherId: `DISP-${Date.now()}`,
                            beneficiaryName: "",
                            beneficiaryAccountOrPhone: "",
                            amount: 0,
                            currencyCode: String(t.currencyCode || "YER"),
                            notes: `تحويل من ${t.nameAr || t.name}`,
                          });
                          setPayoutModalOpen(true);
                        }}
                        className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline inline-flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        <span>تحويل فوري</span>
                      </button>
                    )}
                  </div>

                  {!readOnly && canManageTreasury && (
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100/60 dark:border-slate-800/60 text-[10px]">
                      <button
                        type="button"
                        onClick={() => openEditTreasury(t)}
                        className="font-bold text-slate-600 dark:text-slate-300 hover:text-emerald-600 inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>تعديل</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        {!isArchived ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleLifecycleTreasury(t, "ARCHIVE")}
                              className="text-amber-700 dark:text-amber-400 font-bold hover:underline inline-flex items-center gap-0.5"
                            >
                              <Archive className="w-3 h-3" />
                              <span>أرشفة</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleLifecycleTreasury(t, "SAFE_DELETE")}
                              className="text-rose-600 font-bold hover:underline inline-flex items-center gap-0.5"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>حذف</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleLifecycleTreasury(t, "RESTORE")}
                              className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline inline-flex items-center gap-0.5"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>استعادة</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleLifecycleTreasury(t, "SAFE_DELETE")}
                              className="text-rose-600 font-bold hover:underline inline-flex items-center gap-0.5"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>حذف نهائي</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create / Edit Vault, Bank, or Wallet Drawer */}
      <SlideOverDrawer
        open={setupDrawerOpen && !readOnly && canManageTreasury}
        onClose={() => setSetupDrawerOpen(false)}
        title={
          editingTreasuryId
            ? "تعديل إعدادات الصندوق / البنك / المحفظة"
            : "إضافة صندوق نقدي أو حساب بنكي أو محفظة إلكترونية"
        }
        subtitle="ربط تلقائي بحساب أستاذ من الجيل السادس (Gen-6 / 1111xx / 1112xx) مع دعم الرصيد الافتتاحي وبوابة الربط البنكي"
      >
        <form onSubmit={handleSaveTreasury} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">النوع *</label>
              <SelectWithOther
                value={tType}
                onChange={setTType}
                options={[
                  { value: "VAULT", label: "صندوق نقدي (VAULT)" },
                  { value: "BANK", label: "حساب بنكي (BANK)" },
                  { value: "WALLET", label: "محفظة إلكترونية (WALLET)" },
                ]}
                otherOptionLabel="نوع حساب خزينة مخصص"
                customPlaceholder="مثال: عهدة مؤقتة / حساب ائتمان..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">العملة *</label>
              <select
                value={tCurrency}
                disabled={Boolean(editingTreasuryId)}
                onChange={(e) => setTCurrency(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 disabled:opacity-60"
              >
                <option value="YER">ريال يمني (YER)</option>
                <option value="SAR">ريال سعودي (SAR)</option>
                <option value="USD">دولار أمريكي (USD)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">الاسم (عربي) *</label>
              <input
                type="text"
                required
                value={tNameAr}
                onChange={(e) => setTNameAr(e.target.value)}
                placeholder="مثال: محفظة جوالي / بنك التضامن"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Name (English)</label>
              <input
                type="text"
                value={tNameEn}
                onChange={(e) => setTNameEn(e.target.value)}
                placeholder="Optional English name"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">البنك / مزود المحفظة</label>
              <input
                type="text"
                value={tProviderAr}
                onChange={(e) => setTProviderAr(e.target.value)}
                placeholder="مثال: بنك الكريمي / جوالي"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">اسم صاحب الحساب</label>
              <input
                type="text"
                value={tHolder}
                onChange={(e) => setTHolder(e.target.value)}
                placeholder="الاسم المسجل لدى البنك"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">رقم الحساب / المحفظة</label>
              <input
                type="text"
                value={tAccountNo}
                onChange={(e) => setTAccountNo(e.target.value)}
                placeholder="3012991002"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">IBAN / SWIFT</label>
              <input
                type="text"
                value={tIban}
                onChange={(e) => setTIban(e.target.value)}
                placeholder="اختياري"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-bold mb-1">الفرع / الوكيل</label>
              <input
                type="text"
                value={tBranch}
                onChange={(e) => setTBranch(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">نسبة عمولة التحويل %</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={tFeePercent}
                onChange={(e) => setTFeePercent(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">الحد اليومي</label>
              <input
                type="number"
                min={0}
                value={tDailyLimit}
                onChange={(e) => setTDailyLimit(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 tabular-nums"
              />
            </div>
          </div>

          {/* Opening balance section */}
          {!editingTreasuryId && (
            <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div>
                <label className="block font-bold mb-1">الرصيد الافتتاحي (مقابل 311000)</label>
                <input
                  type="number"
                  min={0}
                  value={tOpeningBalance}
                  onChange={(e) => setTOpeningBalance(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 tabular-nums"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">تاريخ الرصيد الافتتاحي</label>
                <input
                  type="date"
                  value={tOpeningDate}
                  disabled={!canEditDate}
                  onChange={(e) => setTOpeningDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 disabled:opacity-60"
                />
              </div>
            </div>
          )}

          {/* Collapsible Bank / Wallet API Gateway Section */}
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/30 dark:bg-indigo-950/20 overflow-hidden">
            <button
              type="button"
              onClick={() => setGatewaySectionOpen((p) => !p)}
              className="w-full p-3 flex items-center justify-between text-indigo-900 dark:text-indigo-200 font-extrabold hover:bg-indigo-100/40 dark:hover:bg-indigo-950/40 transition"
            >
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>إعدادات الربط البنكي المباشر / API Gateway</span>
                {tGatewayProvider !== "MANUAL" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 font-bold">
                    نشط: {tGatewayProvider}
                  </span>
                )}
              </div>
              {gatewaySectionOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {gatewaySectionOpen && (
              <div className="p-3 border-t border-indigo-200 dark:border-indigo-800/50 space-y-3">
                <div>
                  <label className="block font-bold mb-1">مزود البوابة البنكية (Gateway Provider)</label>
                  <select
                    value={tGatewayProvider}
                    onChange={(e) => setTGatewayProvider(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                  >
                    {GATEWAY_PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {tGatewayProvider !== "MANUAL" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-bold mb-1">معرّف التاجر (Merchant ID)</label>
                        <input
                          type="text"
                          value={tGatewayMerchantId}
                          onChange={(e) => setTGatewayMerchantId(e.target.value)}
                          placeholder="مثال: MERCH-98124"
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">عنوان نقطة النهاية (Endpoint URL)</label>
                        <input
                          type="url"
                          value={tGatewayEndpointUrl}
                          onChange={(e) => setTGatewayEndpointUrl(e.target.value)}
                          placeholder="https://api.kuraimi.com/v1/payout"
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block font-bold">المفتاح السري / رمز الاعتماد (API Secret)</label>
                        <button
                          type="button"
                          onClick={() => setShowSecret((p) => !p)}
                          className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold inline-flex items-center gap-1 hover:underline"
                        >
                          {showSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          <span>{showSecret ? "إخفاء الرمز" : "إظهار الرمز"}</span>
                        </button>
                      </div>
                      <input
                        type={showSecret ? "text" : "password"}
                        value={tGatewayCredentialsEnc}
                        onChange={(e) => setTGatewayCredentialsEnc(e.target.value)}
                        placeholder="أدخل مفتاح الـ API المشفر أو الـ Secret Token"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono"
                      />
                    </div>

                    <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <label className="inline-flex items-center gap-2 font-bold cursor-pointer text-amber-900 dark:text-amber-200">
                        <input
                          type="checkbox"
                          checked={tIsSandbox}
                          onChange={(e) => setTIsSandbox(e.target.checked)}
                          className="rounded border-amber-300 text-amber-600 w-4 h-4"
                        />
                        <span>وضع التجربة والمحاكاة (Sandbox Mode — بدون تحويل أموال حقيقية)</span>
                      </label>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={tDefReceipts}
                onChange={(e) => setTDefReceipts(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 w-4 h-4"
              />
              <span>افتراضي للمقبوضات</span>
            </label>
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={tDefPayments}
                onChange={(e) => setTDefPayments(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 w-4 h-4"
              />
              <span>افتراضي للمدفوعات</span>
            </label>
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={tIsActive}
                onChange={(e) => setTIsActive(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 w-4 h-4"
              />
              <span>حساب نشط</span>
            </label>
          </div>

          <input
            type="text"
            value={tNotes}
            onChange={(e) => setTNotes(e.target.value)}
            placeholder="ملاحظات إضافية..."
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
          />

          <SaveDraftButton
            module="TREASURY"
            formType="TREASURY_ACCOUNT"
            entityId={editingTreasuryId}
            getTitleAr={() => `مسودة حساب خزينة / بنك: ${tNameAr.trim() || "جديد"}`}
            getPayload={() => ({
              type: tType,
              nameAr: tNameAr.trim(),
              nameEn: tNameEn.trim() || undefined,
              currency: tCurrency,
              providerNameAr: tProviderAr.trim() || undefined,
              accountHolderName: tHolder.trim() || undefined,
              accountNumber: tAccountNo.trim() || undefined,
              ibanOrSwift: tIban.trim() || undefined,
              branchOrAgent: tBranch.trim() || undefined,
              transferFeePercent: Number(tFeePercent) || 0,
              dailyLimit: Number(tDailyLimit) || 0,
              isDefaultReceipts: tDefReceipts,
              isDefaultPayments: tDefPayments,
              isActive: tIsActive,
              notes: tNotes.trim() || undefined,
              gatewayProvider: tGatewayProvider,
              gatewayMerchantId: tGatewayMerchantId.trim() || undefined,
              gatewayEndpointUrl: tGatewayEndpointUrl.trim() || undefined,
              gatewayCredentialsEnc: tGatewayCredentialsEnc.trim() || undefined,
              isSandbox: tIsSandbox,
            })}
            actor={actor}
            onToast={onToast}
            className="w-full"
          />

          <button
            type="submit"
            disabled={savingTreasury}
            className="w-full py-2.5 rounded-xl accent-bg font-extrabold shadow-sm disabled:opacity-60"
          >
            {savingTreasury
              ? "جاري الحفظ..."
              : editingTreasuryId
              ? "حفظ التعديلات على الحساب"
              : "+ إنشاء الحساب وربطه بشجرة الحسابات"}
          </button>
        </form>
      </SlideOverDrawer>

      {/* Inter-Treasury FX Transfer Drawer */}
      <SlideOverDrawer
        open={transferDrawerOpen && !readOnly && canManageTreasury}
        onClose={() => setTransferDrawerOpen(false)}
        title="تحويل مالي بين الخزائن والبنوك والمحافظ (FX Transfer)"
        subtitle="قيد مزدوج آلي مع احتساب رسوم التحويل البنكية في حساب (531200)"
      >
        <form onSubmit={handleTransferSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-bold mb-1">من حساب (المصدر) *</label>
            <select
              value={txFromId}
              onChange={(e) => setTxFromId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
            >
              {treasuryAccounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameAr || t.name} ({t.currencyCode} • {fmtNum(t.balanceYER)} YER)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold mb-1">إلى حساب (الوجهة) *</label>
            <select
              value={txToId}
              onChange={(e) => setTxToId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
            >
              {treasuryAccounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameAr || t.name} ({t.currencyCode} • {fmtNum(t.balanceYER)} YER)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">
                المبلغ المحوّل ({fromAcc?.currencyCode || "YER"}) *
              </label>
              <input
                type="number"
                min={1}
                step="0.01"
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">سعر الصرف المخصص (اختياري)</label>
              <input
                type="number"
                step="0.01"
                value={txRateOverride}
                onChange={(e) => setTxRateOverride(e.target.value)}
                placeholder="السعر المعتمد آلياً"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 tabular-nums"
              />
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={txApplyDefaultFee}
                onChange={(e) => setTxApplyDefaultFee(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 w-4 h-4"
              />
              <span>
                تطبيق نسبة عمولة المصدر الافتراضية ({fromAcc?.transferFeePercent ?? 0}% ≈{" "}
                {fmtNum(computedDefaultFee)})
              </span>
            </label>
            <div>
              <label className="block font-bold mb-1">أو تحديد رسوم تحويل يدوية (531200)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={txFeeAmount}
                onChange={(e) => setTxFeeAmount(e.target.value)}
                placeholder="اتركه فارغاً للاعتماد على العمولة الافتراضية"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">التاريخ</label>
              <input
                type="date"
                value={txDate}
                disabled={!canEditDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">المرجع البنكي / رقم الحوالة</label>
              <input
                type="text"
                value={txReference}
                onChange={(e) => setTxReference(e.target.value)}
                placeholder="REF-TRF-..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
              />
            </div>
          </div>

          <input
            type="text"
            value={txNotes}
            onChange={(e) => setTxNotes(e.target.value)}
            placeholder="بيان التحويل المالي..."
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
          />

          <button
            type="submit"
            disabled={submittingTransfer}
            className="w-full py-2.5 rounded-xl accent-bg font-extrabold shadow-sm disabled:opacity-60"
          >
            {submittingTransfer ? "جاري الترحيل..." : "تنفيذ التحويل وترحيل القيد للـ GL"}
          </button>
        </form>
      </SlideOverDrawer>

      {/* Bank / Wallet Statement Reconciliation Drawer */}
      <SlideOverDrawer
        open={reconcileDrawerOpen}
        onClose={() => setReconcileDrawerOpen(false)}
        title={
          reconcileData
            ? `كشف ومطابقة الحساب: ${reconcileData.treasury.nameAr}`
            : "كشف ومطابقة الخزينة / البنك"
        }
        subtitle="مراجعة حركات الأستاذ المساعد (Gen-6 GL)، تصدير ملفات التحويلات البنكية، والمطابقة التلقائية مع كشف البنك"
      >
        {reconcileLoading || !reconcileData ? (
          <div className="py-12 text-center text-xs text-slate-500">جاري تحميل حركات الأستاذ...</div>
        ) : (
          <div className="space-y-4 text-xs">
            {/* Balance Summary Header */}
            <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 tabular-nums text-center">
              <div>
                <div className="text-[10px] text-slate-500">رصيد البطاقة</div>
                <div className="font-extrabold text-emerald-600">
                  {fmtNum(reconcileData.treasury.balanceYER)} YER
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">رصيد الأستاذ (GL)</div>
                <div className="font-extrabold">
                  {fmtNum(reconcileData.treasury.glBookBalanceYER)} YER
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">الفرق الدفتري</div>
                <div
                  className={`font-extrabold ${
                    Math.abs(reconcileData.treasury.varianceYER) < 0.01
                      ? "text-emerald-600"
                      : "text-rose-600"
                  }`}
                >
                  {fmtNum(reconcileData.treasury.varianceYER)} YER
                </div>
              </div>
            </div>

            {/* Bulk Bank File Export Section */}
            <div className="p-3 rounded-2xl border border-indigo-200 dark:border-indigo-800/40 bg-indigo-50/30 dark:bg-indigo-950/20 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-extrabold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>تصدير ملف تحويلات بنكية (Bulk Bank File)</span>
                </div>
                <select
                  value={batchFormat}
                  onChange={(e) => setBatchFormat(e.target.value as "xlsx" | "csv")}
                  className="rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] font-bold"
                >
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="csv">CSV (.csv)</option>
                </select>
              </div>
              <p className="text-[11px] text-slate-500">
                توليد ملف دفع جماعي معتمد ومتوافق مع بوابات البنوك اليمنية (الكريمي إكسبرس، جوالي، جيب، ون كاش)
              </p>
              <button
                type="button"
                disabled={exportingBatch}
                onClick={handleExportBulkFile}
                className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60"
              >
                {exportingBatch ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>جاري إنشاء الملف...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>تحميل ملف الحوالات الجماعية ({batchFormat.toUpperCase()})</span>
                  </>
                )}
              </button>
            </div>

            {/* Auto-Reconcile Bank Statement Upload Section */}
            <div className="p-3 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/30 dark:bg-emerald-950/20 space-y-2.5">
              <div className="font-extrabold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>استيراد كشف للمطابقة التلقائية (Auto-Reconcile Excel/CSV)</span>
              </div>
              <p className="text-[11px] text-slate-500">
                مطابقة فورية ذكية بين كشف حساب البنك الخارجي والقيود المرحلة في دفتر الأستاذ العام
              </p>

              <label className="block cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleAutoReconcileUpload}
                  disabled={autoReconciling}
                  className="hidden"
                />
                <div className="w-full py-2.5 px-3 rounded-xl border-2 border-dashed border-emerald-400 dark:border-emerald-700 bg-white/70 dark:bg-slate-900/60 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/40 text-center transition">
                  {autoReconciling ? (
                    <div className="flex items-center justify-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-bold">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>جاري مطابقة كشف الحساب التلقائي...</span>
                    </div>
                  ) : (
                    <div className="text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>اضغط لاختيار كشف البنك (.xlsx / .csv) للمطابقة الفورية</span>
                    </div>
                  )}
                </div>
              </label>

              {/* Auto-Reconcile Matching Results Summary */}
              {autoReconcileResult && (
                <div className="space-y-2 pt-2 border-t border-emerald-200 dark:border-emerald-800/40 animate-in fade-in">
                  <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                    <div className="p-2 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800">
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold">طابق بالكامل</div>
                      <div className="font-extrabold text-sm text-emerald-900 dark:text-emerald-100">
                        {autoReconcileResult.matchedCount}
                      </div>
                      <div className="text-[9px] text-slate-500">
                        {fmtNum(autoReconcileResult.matchedTotal)} YER
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-amber-100/70 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800">
                      <div className="text-[10px] text-amber-700 dark:text-amber-300 font-bold">غير مسجل بالنظام</div>
                      <div className="font-extrabold text-sm text-amber-900 dark:text-amber-100">
                        {autoReconcileResult.unmatchedUasCount}
                      </div>
                      <div className="text-[9px] text-slate-500">
                        {fmtNum(autoReconcileResult.unmatchedUasTotal)} YER
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-rose-100/70 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800">
                      <div className="text-[10px] text-rose-700 dark:text-rose-300 font-bold">غير ظاهر بالبنك</div>
                      <div className="font-extrabold text-sm text-rose-900 dark:text-rose-100">
                        {autoReconcileResult.unmatchedBankCount}
                      </div>
                      <div className="text-[9px] text-slate-500">
                        {fmtNum(autoReconcileResult.unmatchedBankTotal)} YER
                      </div>
                    </div>
                  </div>

                  {autoReconcileResult.details.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1 pe-1">
                      {autoReconcileResult.details.slice(0, 15).map((d, i) => (
                        <div
                          key={i}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between text-[11px]"
                        >
                          <div className="truncate max-w-[200px]">
                            <span className="font-bold">{d.description || d.referenceId || "حركة بنكية"}</span>
                            <span className="text-[10px] text-slate-400 block font-mono">{d.date}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold tabular-nums">{fmtNum(d.amount)}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                d.status === "MATCHED"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                                  : d.status === "UNMATCHED_IN_SYSTEM"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                  : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                              }`}
                            >
                              {d.status === "MATCHED"
                                ? "مطابق"
                                : d.status === "UNMATCHED_IN_SYSTEM"
                                ? "بالبنك فقط"
                                : "بالنظام فقط"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Manual Statement Balance Confirmation Form */}
            {!readOnly && canManageTreasury && (
              <form
                onSubmit={handleSaveStatementReconcile}
                className="p-3 rounded-2xl border border-indigo-200 dark:border-indigo-800/40 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-2.5"
              >
                <div className="font-extrabold text-indigo-800 dark:text-indigo-300">
                  اعتماد رصيد الكشف البنكي / الفعلي
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold mb-1">رصيد الكشف (YER)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={stmtBalance}
                      onChange={(e) => setStmtBalance(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">تاريخ الكشف</label>
                    <input
                      type="date"
                      value={stmtDate}
                      onChange={(e) => setStmtDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span>فارق المطابقة مع الكشف:</span>
                  <span className="tabular-nums text-indigo-700 dark:text-indigo-300">
                    {fmtNum((Number(stmtBalance) || 0) - reconcileData.treasury.glBookBalanceYER)} YER
                  </span>
                </div>
                <input
                  type="text"
                  value={stmtNotes}
                  onChange={(e) => setStmtNotes(e.target.value)}
                  placeholder="ملاحظات المطابقة الدورية..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5"
                />
                <button
                  type="submit"
                  disabled={savingReconcile}
                  className="w-full py-2 rounded-xl accent-bg font-bold"
                >
                  {savingReconcile ? "جاري التوثيق..." : "حفظ واعتماد المطابقة"}
                </button>
              </form>
            )}

            {/* Ledger entries list */}
            <div className="space-y-2">
              <div className="font-extrabold">
                حركات دفتر الأستاذ المرتبطة ({reconcileData.entries.length})
              </div>
              {reconcileData.entries.length === 0 ? (
                <div className="text-center py-6 text-slate-400">لا توجد قيود مرحلة على هذا الحساب</div>
              ) : (
                <div className="space-y-1.5 max-h-[340px] overflow-y-auto pe-1">
                  {reconcileData.entries.map((entry) => (
                    <div
                      key={entry.lineId}
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 flex items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {entry.entryNumber}
                          </span>
                          <span className="font-mono text-slate-400 text-[10px]">
                            {entry.date}
                          </span>
                        </div>
                        <div className="truncate text-slate-700 dark:text-slate-300">
                          {entry.narrationAr || "حركة مالية"}
                        </div>
                        {entry.reference && (
                          <div className="text-[10px] font-mono text-slate-400">
                            المرجع: {entry.reference}
                          </div>
                        )}
                        <div className="tabular-nums font-bold flex items-center gap-2 pt-0.5">
                          {entry.debitBase > 0 && (
                            <span className="text-emerald-600">
                              مدين (وارد): +{fmtNum(entry.debitBase)} YER
                            </span>
                          )}
                          {entry.creditBase > 0 && (
                            <span className="text-rose-600">
                              دائن (منصرف): -{fmtNum(entry.creditBase)} YER
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleToggleReconciledEntry(entry)}
                        disabled={readOnly || !canManageTreasury}
                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold shrink-0 inline-flex items-center gap-1 disabled:opacity-60 ${
                          entry.reconciled
                            ? "bg-emerald-100 text-emerald-800"
                            : "border border-slate-300 text-slate-600"
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{entry.reconciled ? "مطابق" : "تأشير"}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SlideOverDrawer>

      {/* Existing Installment Voucher Drawer */}
      <SlideOverDrawer
        open={drawerOpen && !readOnly}
        onClose={() => setDrawerOpen(false)}
        title="إصدار سند قبض / صرف دفعة (Installment Voucher)"
        subtitle="تخفيض مديونية العميل أو مستحقات العامل وتحديث رصيد الخزينة والـ GL تلقائياً"
      >
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">نوع العملية</label>
            <select
              value={type}
              onChange={(e) =>
                handleTypeChange(e.target.value as "CUSTOMER_RECEIPT" | "WORKER_PAYOUT")
              }
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="CUSTOMER_RECEIPT">
                سند قبض دفعة من عميل (تخفيض مديونية عميل)
              </option>
              <option value="WORKER_PAYOUT">
                سند صرف دفعة لعامل (تخفيض مستحقات عامل)
              </option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">الفاتورة / السجل المرتبط</label>
            <select
              value={effectiveTargetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              {type === "CUSTOMER_RECEIPT"
                ? sales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.customer} — {s.batch} (مدين متبقي: {fmtNum(s.debit)} ريال)
                    </option>
                  ))
                : workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} — {w.harvest} (متبقي له: {fmtNum(w.debit)} ريال)
                    </option>
                  ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">الصندوق / البنك / المحفظة</label>
            <select
              value={treasuryId}
              onChange={(e) => setTreasuryId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              {treasuryAccounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({formatCurrencyVal(t.balanceYER, currency, exchangeRates)})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">المبلغ (بالريال اليمني YER)</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                inputMode="numeric"
                min={100}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">رقم السند</label>
              <input
                value={voucherNo}
                onChange={(e) => setVoucherNo(e.target.value)}
                type="text"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">التاريخ</label>
              <input
                value={date}
                disabled={!canEditDate}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">ملاحظات الدفعة</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                type="text"
                placeholder="دفعة جزئية من الحساب"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
          <CostCenterSelector value={costCenterId} onChange={setCostCenterId} />
          <SaveDraftButton
            module="TREASURY"
            formType={type === "CUSTOMER_RECEIPT" ? "RECEIPT_VOUCHER" : "PAYMENT_VOUCHER"}
            getTitleAr={() => `مسودة سند ${voucherNo}`}
            getPayload={() => ({
              type,
              targetId,
              treasuryId,
              amount: Number(amount) || 0,
              voucherNo,
              date,
              notes,
              costCenterId: costCenterId || null,
            })}
            getTotalAmount={() => Number(amount) || null}
            actor={actor}
            onToast={onToast}
            className="w-full"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
            + حفظ السند وتحديث الحساب والخزينة
          </button>
        </form>
      </SlideOverDrawer>

      {/* Installments Table */}
      <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-extrabold">سجل سندات القبض والصرف والدفعات المتعددة</h4>
          <div className="flex items-center gap-2 no-print">
            <button
              onClick={onExportExcel}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
            >
              تصدير السندات Excel
            </button>
            {!readOnly && (
              <button
                id="instAmountInput"
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إصدار سند قبض / صرف</span>
              </button>
            )}
          </div>
        </div>

        {installments.length === 0 ? (
          <EmptyState
            title="لا توجد سندات دفعات مسجلة"
            description="قم بإصدار سند قبض من عميل أو سند صرف لعامل ليظهر في سجل الخزينة."
          />
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold">
                <th className="p-2.5">رقم السند</th>
                <th className="p-2.5">النوع</th>
                <th className="p-2.5">الطرف المستفيد / المسدد</th>
                <th className="p-2.5">الصندوق / البنك</th>
                <th className="p-2.5">المبلغ</th>
                <th className="p-2.5">التاريخ</th>
                <th className="p-2.5">البيان</th>
                <th className="p-2.5 no-print">طباعة / عرض</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {installments.map((inst) => {
                const tr = treasuryAccounts.find((t) => t.id === inst.treasuryId);
                const isCust = inst.type === "CUSTOMER_RECEIPT";
                return (
                  <tr key={inst.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="p-2.5 font-mono font-bold">{inst.voucherNo}</td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isCust
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        }`}
                      >
                        {isCust ? "قبض من عميل" : "صرف لعامل"}
                      </span>
                    </td>
                    <td className="p-2.5 font-semibold">{inst.targetName || "—"}</td>
                    <td className="p-2.5">{tr ? tr.name : "صندوق"}</td>
                    <td className="p-2.5 font-extrabold text-emerald-600 tabular-nums">
                      {fmtNum(inst.amount)} YER
                    </td>
                    <td className="p-2.5 font-mono text-slate-500">{inst.date}</td>
                    <td className="p-2.5 text-slate-600 dark:text-slate-400">{inst.notes || "—"}</td>
                    <td className="p-2.5 no-print">
                      <button
                        type="button"
                        onClick={() => onOpenInstallmentModal(inst)}
                        className="px-2.5 py-1 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold hover:underline"
                      >
                        عرض السند
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Shared Bank Payout Execution Modal */}
      <BankPayoutModal
        isOpen={payoutModalOpen}
        onClose={() => {
          setPayoutModalOpen(false);
          setPayoutInitialData(null);
        }}
        treasuryAccounts={treasuryAccounts}
        currentUser={currentUser}
        initialData={payoutInitialData}
        onSuccess={async () => {
          await onRefreshState?.();
        }}
        onToast={onToast}
      />
    </section>
  );
}
