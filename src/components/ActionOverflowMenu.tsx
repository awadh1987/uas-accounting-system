"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, MoreVertical, X } from "lucide-react";

export interface ActionOverflowItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void | Promise<void>;
  tone?: "default" | "warning" | "danger";
  /**
   * When set (or when `tone === "danger"` unless `skipConfirm` is true),
   * clicking the item prompts a clear confirmation step before invoking `onClick`.
   */
  confirmTitle?: string;
  confirmMessage?: string;
  skipConfirm?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  dividerBefore?: boolean;
}

interface ActionOverflowMenuProps {
  items: ActionOverflowItem[];
  label?: string;
  align?: "start" | "end";
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  testId?: string;
}

export function ActionOverflowMenu({
  items,
  label = "المزيد من الخيارات",
  align = "end",
  size = "sm",
  disabled = false,
  className = "",
  buttonClassName = "",
  testId,
}: ActionOverflowMenuProps) {
  const visibleItems = items.filter((item) => !item.hidden);
  const [open, setOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<ActionOverflowItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open && !pendingConfirm) return;
    const handlePointerDown = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
        setPendingConfirm(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, pendingConfirm]);

  if (visibleItems.length === 0) return null;

  const sizeCls =
    size === "xs"
      ? "h-7 w-7 text-xs"
      : size === "md"
      ? "h-9 w-9 text-sm"
      : "h-8 w-8 text-xs";

  const runAction = async (item: ActionOverflowItem) => {
    setBusyId(item.id);
    try {
      await item.onClick();
    } finally {
      setBusyId(null);
      setOpen(false);
      setPendingConfirm(null);
    }
  };

  const handleSelectItem = (item: ActionOverflowItem) => {
    if (item.disabled || busyId) return;
    const needsConfirm =
      !item.skipConfirm && (Boolean(item.confirmMessage) || item.tone === "danger");
    if (needsConfirm) {
      setOpen(false);
      setPendingConfirm(item);
      return;
    }
    void runAction(item);
  };

  return (
    <div ref={containerRef} className={`relative inline-flex shrink-0 ${className}`}>
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((prev) => !prev);
        }}
        className={`${sizeCls} inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50 ${buttonClassName}`}
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          dir="rtl"
          className={`absolute top-full mt-1.5 z-50 min-w-[190px] max-w-[260px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl py-1.5 text-right ${
            align === "start" ? "start-0" : "end-0"
          }`}
        >
          {visibleItems.map((item) => {
            const toneCls =
              item.tone === "danger"
                ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60"
                : item.tone === "warning"
                ? "text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/60"
                : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800";

            return (
              <React.Fragment key={item.id}>
                {item.dividerBefore && (
                  <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled || busyId === item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectItem(item);
                  }}
                  className={`w-full px-3 py-2 text-xs font-bold flex items-center gap-2 text-right transition-colors disabled:opacity-45 ${toneCls}`}
                >
                  {item.icon && <span className="shrink-0">{item.icon}</span>}
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {pendingConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          dir="rtl"
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-[100] bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 space-y-1">
                <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {pendingConfirm.confirmTitle || `تأكيد: ${pendingConfirm.label}`}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {pendingConfirm.confirmMessage ||
                    "هل أنت متأكد من تنفيذ هذا الإجراء؟ لا يمكن التراجع عنه في حال الحذف النهائي."}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                disabled={busyId !== null}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-3.5 h-3.5" />
                <span>إلغاء</span>
              </button>
              <button
                type="button"
                onClick={() => void runAction(pendingConfirm)}
                disabled={busyId !== null}
                className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{busyId ? "جارٍ التنفيذ..." : pendingConfirm.label}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
